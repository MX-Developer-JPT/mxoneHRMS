# Building the Maxvolt One iOS App — Beginner's Guide

This guide walks you through everything needed to turn the `ios-build.yml`
GitHub Actions workflow into a working pipeline that produces a signed
`.ipa` file for Maxvolt One, and (optionally) uploads it straight to
TestFlight — all without needing a Mac yourself.

No prior iOS/Xcode experience assumed. Where a step normally needs a Mac,
we use a Windows-friendly alternative (OpenSSL) instead.

---

## 0. Glossary (skim this once, refer back as needed)

| Term | What it actually means |
|---|---|
| **Apple Developer Program** | A paid ($99/year) Apple account tier required to distribute apps. Without it, none of this works. |
| **Team ID** | A 10-character code identifying your Apple Developer account (e.g. `A1B2C3D4E5`). |
| **Bundle ID** | The app's unique identifier. For this app it's `com.maxvolt.hr` — already set, don't change it. |
| **Certificate (.p12)** | A cryptographic "signature" proving you're allowed to publish under your Apple account. Distribution certificates are used for App Store / TestFlight builds. |
| **Provisioning Profile (.mobileprovision)** | A file that ties together: your App ID, your certificate, and (for Ad Hoc) which physical devices can install the app. |
| **.ipa** | The actual iOS app package — the iOS equivalent of an `.apk` or `.exe`. This is the file you eventually upload to App Store Connect. |
| **App Store Connect** | The web dashboard (separate from the Developer Portal) where you manage app listings, TestFlight testers, and submissions. |
| **TestFlight** | Apple's beta-testing platform — lets you install pre-release builds without going through full App Store review. |
| **GitHub Secrets** | Encrypted values stored in your GitHub repo settings, injected into workflow runs. This is where all the credentials below end up. |

---

## 1. Prerequisites

- **An active Apple Developer Program membership** — enroll at
  [developer.apple.com/programs](https://developer.apple.com/programs/enroll/)
  if you haven't already ($99/year, can take up to 48 hours for approval).
- **Admin access to the `MX-Developer-JPT/mxoneHRMS` GitHub repo** (to add
  secrets and run the workflow).
- **OpenSSL** — used to generate the certificate request without needing a
  Mac. If you use Git Bash (which you already have, since you use it for
  git), OpenSSL is bundled with it. Otherwise install from
  [slproweb.com/products/Win32OpenSSL.html](https://slproweb.com/products/Win32OpenSSL.html).

---

## 2. Find your Team ID

1. Go to [developer.apple.com/account](https://developer.apple.com/account)
   and sign in.
2. Click **Membership Details** in the sidebar.
3. Copy the **Team ID** (10 characters, e.g. `A1B2C3D4E5`).
4. Save this — you'll paste it into GitHub as `IOS_TEAM_ID` in step 7.

---

## 3. Register the App ID (one-time setup)

1. Go to [developer.apple.com/account/resources/identifiers/list](https://developer.apple.com/account/resources/identifiers/list).
2. Click the **+** button → choose **App IDs** → **Continue** → **App** → **Continue**.
3. Fill in:
   - **Description**: `Maxvolt One`
   - **Bundle ID**: select **Explicit**, enter `com.maxvolt.hr`
   - Leave capabilities as default unless you know you need Push
     Notifications (this app uses Firebase Cloud Messaging — if push
     hasn't been enabled yet, check the **Push Notifications** capability box).
4. Click **Continue** → **Register**.

You only need to do this once per Apple account, ever.

---

## 4. Create a Distribution Certificate (without a Mac)

This is the fiddliest step. You're creating a certificate request (CSR),
uploading it to Apple, downloading the signed certificate back, then
combining it with your private key into a `.p12` file.

**In Git Bash** (or any terminal with OpenSSL), run these commands one at a
time. Pick a folder to work in first, e.g.:

```bash
mkdir ~/ios-cert && cd ~/ios-cert
```

**4.1 — Generate a private key and CSR:**

```bash
openssl genrsa -out ios_distribution.key 2048
openssl req -new -key ios_distribution.key -out ios_distribution.csr -subj "/emailAddress=YOUR_APPLE_ID_EMAIL, CN=Maxvolt Energy, C=IN"
```

Replace `YOUR_APPLE_ID_EMAIL` with the email of your Apple Developer
account. This creates `ios_distribution.csr` — that's the file Apple needs.

**4.2 — Upload the CSR to Apple:**

1. Go to [developer.apple.com/account/resources/certificates/list](https://developer.apple.com/account/resources/certificates/list).
2. Click **+** → under **Software** choose **Apple Distribution** → **Continue**.
3. Click **Choose File**, select `ios_distribution.csr`, click **Continue**.
4. Click **Download** — this gives you a file like `distribution.cer`.
   Move it into the same `~/ios-cert` folder.

**4.3 — Convert to a `.p12` file:**

```bash
openssl x509 -in distribution.cer -inform DER -out distribution.pem -outform PEM
openssl pkcs12 -export -inkey ios_distribution.key -in distribution.pem -out distribution.p12 -passout pass:YOUR_CHOSEN_PASSWORD
```

Replace `YOUR_CHOSEN_PASSWORD` with any password you make up — you'll need
it again in step 7. **Write it down somewhere safe.**

You now have `distribution.p12` — this is your `IOS_DIST_CERT_P12_BASE64`
source file, and the password you chose is `IOS_DIST_CERT_PASSWORD`.

---

## 5. Create a Provisioning Profile

1. Go to [developer.apple.com/account/resources/profiles/list](https://developer.apple.com/account/resources/profiles/list).
2. Click **+**.
3. Under **Distribution**, choose:
   - **App Store Connect** — if you plan to submit to the App Store or
     TestFlight (recommended, matches the `app-store` export method in the
     workflow).
   - **Ad Hoc** — only if you want to install directly on specific test
     devices without going through TestFlight (needs each device's UDID
     registered first — more setup, skip this unless you specifically need it).
4. Click **Continue**.
5. Select the **App ID** you created in step 3 (`com.maxvolt.hr`) → **Continue**.
6. Select the **Distribution Certificate** you created in step 4 → **Continue**.
7. Give it a **Profile Name** — something memorable, e.g.
   `Maxvolt One App Store`. **Write this exact name down** — it's your
   `IOS_PROVISIONING_PROFILE_NAME` value in step 7 (must match exactly,
   including capitalization).
8. Click **Generate**, then **Download**. This gives you a `.mobileprovision`
   file — move it into your `~/ios-cert` folder.

---

## 6. Convert files to base64

GitHub Secrets only accept text, so the certificate and profile (both
binary files) need to be base64-encoded first. In Git Bash, from the
`~/ios-cert` folder:

```bash
base64 -w 0 distribution.p12 > distribution.p12.base64.txt
base64 -w 0 profile.mobileprovision > profile.mobileprovision.base64.txt
```

(The `.mobileprovision` file downloaded in step 5 might have a different
exact filename — check what's in your folder and adjust the command.)

Each `.txt` file now contains one long line of text — that's what you paste
into GitHub in the next step. **Never commit these files or paste them
anywhere public** — they're equivalent to a password.

---

## 7. Add the secrets to GitHub

1. Go to the repo on GitHub: `github.com/MX-Developer-JPT/mxoneHRMS`.
2. Click **Settings** (top menu) → **Secrets and variables** → **Actions**
   (left sidebar) → **New repository secret**.
3. Add each of these one at a time (click **New repository secret** for each):

| Secret name | Value |
|---|---|
| `IOS_DIST_CERT_P12_BASE64` | Contents of `distribution.p12.base64.txt` |
| `IOS_DIST_CERT_PASSWORD` | The password you made up in step 4.3 |
| `IOS_PROVISION_PROFILE_BASE64` | Contents of `profile.mobileprovision.base64.txt` |
| `IOS_TEAM_ID` | The 10-character Team ID from step 2 |
| `IOS_PROVISIONING_PROFILE_NAME` | The exact profile name you typed in step 5.7 |

To paste a `.txt` file's contents: open it in Notepad (or `cat filename`
in Git Bash to print it, then select and copy the output), select all,
copy, and paste into GitHub's "Secret" text box.

---

## 8. (Optional) Set up TestFlight auto-upload

Skip this section if you're fine downloading the `.ipa` and uploading it
yourself later (see step 11). If you want the workflow to push straight to
TestFlight automatically, you need an **App Store Connect API Key**:

1. Go to [appstoreconnect.apple.com/access/api](https://appstoreconnect.apple.com/access/api).
   (This is a **different site** from the Developer Portal you used above —
   don't confuse the two.)
2. Under **Keys**, click **+** to generate a new key.
3. Name it anything (e.g. `GitHub Actions`), set **Access** to **Admin**
   (or **App Manager**, which is enough for uploads).
4. Click **Generate**. You'll see:
   - **Key ID** — a short code, e.g. `A1B2C3D4E5`. This is your
     `APPSTORE_API_KEY_ID`.
   - **Issuer ID** — a UUID shown above the keys table. This is your
     `APPSTORE_API_ISSUER_ID`.
5. Click **Download API Key** — **you can only download this once ever**,
   so save it immediately. It's a file named like `AuthKey_A1B2C3D4E5.p8`.
6. Base64-encode it the same way as before:
   ```bash
   base64 -w 0 AuthKey_A1B2C3D4E5.p8 > apikey.base64.txt
   ```
7. Add three more GitHub secrets (same process as step 7):

| Secret name | Value |
|---|---|
| `APPSTORE_API_KEY_ID` | The Key ID from above |
| `APPSTORE_API_ISSUER_ID` | The Issuer ID from above |
| `APPSTORE_API_KEY_BASE64` | Contents of `apikey.base64.txt` |

---

## 9. Trigger the workflow

1. Go to the repo on GitHub → click the **Actions** tab.
2. In the left sidebar, click **Build iOS IPA**.
3. Click the **Run workflow** dropdown button (top right of the runs list).
4. Choose:
   - **export_method**: `app-store` (for TestFlight/App Store submission —
     use this in almost all cases) or `ad-hoc` (only if you set up Ad Hoc
     provisioning in step 5).
   - **upload_to_testflight**: check this box only if you completed step 8
     and want automatic upload.
5. Click the green **Run workflow** button.
6. The build takes roughly 5–10 minutes. Click into the running job to
   watch live logs — useful for diagnosing errors (see Troubleshooting below).

---

## 10. Download the .ipa

1. Once the workflow run finishes (green checkmark), click into that run.
2. Scroll to the **Artifacts** section at the bottom of the run summary page.
3. Click **maxvolt-one-ipa** to download a zip containing the `.ipa` file.
4. Artifacts are kept for 30 days, then auto-deleted — download promptly
   if you need to keep it long-term.

---

## 11. Upload to App Store Connect / TestFlight

**If you enabled auto-upload in step 8/9**, this already happened — check
[appstoreconnect.apple.com](https://appstoreconnect.apple.com) → your app →
**TestFlight** tab. New builds take 5–30 minutes to finish Apple's own
processing before appearing as installable.

**If you didn't**, you need a Mac to do the manual upload (Apple doesn't
provide a Windows tool for this step):

1. On a Mac, open the **Transporter** app (free, from the Mac App Store).
2. Sign in with your Apple ID.
3. Drag the downloaded `.ipa` file into Transporter.
4. Click **Deliver**.
5. Same as above — check App Store Connect → TestFlight after a few minutes.

If you don't have access to any Mac at all, go back to step 8 and set up
auto-upload — it's the only fully Windows-only path.

---

## 12. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `No signing certificate "iOS Distribution" found` | The `.p12` or its password is wrong, or wasn't imported correctly. Double-check `IOS_DIST_CERT_PASSWORD` matches exactly what you set in step 4.3. |
| `Provisioning profile doesn't match the entitlements` | The profile in step 5 wasn't built against the same App ID/certificate, or push entitlements changed since the App ID was registered — regenerate the profile after fixing capabilities. |
| `No profiles for 'com.maxvolt.hr' were found` | `IOS_PROVISIONING_PROFILE_NAME` doesn't exactly match the profile name from step 5.7 (check for typos/extra spaces). |
| Workflow fails at "Import signing certificate" step | One of the base64 secrets is malformed — re-run the `base64 -w 0` command and make sure you copied the *entire* single-line output, no line breaks. |
| TestFlight upload fails with an authentication error | `APPSTORE_API_KEY_ID` / `APPSTORE_API_ISSUER_ID` swapped, or the API key's access role is too low — regenerate it with **App Manager** or **Admin** access. |
| Build succeeds but app crashes immediately on device | Usually unrelated to signing — check the app's own runtime logs (Xcode's Console app on a real Mac, or ask for a debug build instead). |

---

## Quick reference — where everything came from

| GitHub secret | Apple source |
|---|---|
| `IOS_TEAM_ID` | Developer Portal → Membership Details |
| `IOS_DIST_CERT_P12_BASE64` | Developer Portal → Certificates (converted locally with OpenSSL) |
| `IOS_DIST_CERT_PASSWORD` | Made up by you in step 4.3 |
| `IOS_PROVISION_PROFILE_BASE64` | Developer Portal → Profiles |
| `IOS_PROVISIONING_PROFILE_NAME` | The name you typed when creating the profile |
| `APPSTORE_API_KEY_ID` / `APPSTORE_API_ISSUER_ID` / `APPSTORE_API_KEY_BASE64` | App Store Connect → Users and Access → Keys (**not** the Developer Portal) |

Once all five required secrets are in place, every future build is just:
**Actions tab → Build iOS IPA → Run workflow → wait → download.**
