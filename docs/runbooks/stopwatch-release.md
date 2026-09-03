# Runbook: SplitSync Stopwatch — Play Store Release

The SplitSync Stopwatch (`org.splitsync.stopwatch`) is a standalone Expo app built and submitted via EAS Build. This runbook covers cutting a production release for Android.

## Prerequisites

- EAS CLI installed globally: `npm install -g eas-cli`
- Logged in to the Expo account that owns the project: `eas login`
- Google Play Console access to the `org.splitsync.stopwatch` app
- Signing keystore stored in EAS credentials (remote). To verify: `eas credentials` → Android → Production → confirm keystore is present. If this is the first release, EAS will prompt to generate and upload a keystore during the build.

## Environment Variables

The shared-session feature requires Supabase credentials at build time. Set these in `eas.json` under the `production` profile (or in the Expo dashboard under Environment Variables):

```
EXPO_PUBLIC_SUPABASE_URL=https://bsihlrzncucrglqltjrc.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<Supabase publishable key>
```

Do **not** add a Supabase service-role key. These are the same public client values used by the web and mobile tracker apps.

For local development without EAS, create `apps/stopwatch/.env`:

```text
EXPO_PUBLIC_SUPABASE_URL=https://bsihlrzncucrglqltjrc.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<Supabase publishable key>
```

## Versioning

`eas.json`'s `cli.appVersionSource` is `"remote"` — EAS's servers own the Android `versionCode` counter centrally, and `production.autoIncrement: true` bumps it by one on every build automatically. **Do not** add `android.versionCode` back to `apps/stopwatch/app.json`; it's ignored (and warned about) under remote version source. This means:

- Any build — local, CI, or `eas build` cloud — always gets a fresh, unique, monotonically increasing versionCode with no manual bump and no git commit required.
- To check the current counter: `eas build:version:get --platform android` (from `apps/stopwatch`).
- Only bump the human-readable `version` string in `app.json` yourself when cutting a release with user-visible changes (e.g. `"1.1.0"`).

(Historically this used `appVersionSource: "local"`, which bumped `app.json` in place per build but never committed the change — every fresh checkout restarted from the same stale number and could collide with a versionCode Play Console had already seen. Remote mode avoids that class of bug entirely.)

## Build

### Option A — GitHub Actions (recommended)

Run the **stopwatch Play Store release build** workflow from the Actions tab (`workflow_dispatch`, no inputs needed). It builds the signed `.aab` directly on a GitHub-hosted runner via `eas build --local` — this skips EAS's cloud build queue entirely (which can back up for hours on the free tier) while GitHub Actions minutes are unlimited for this public repo. EAS still supplies the signing keystore and Supabase environment variables remotely; nothing sensitive is stored in the repo.

Download the `.aab` from the workflow run's **Artifacts** section once it completes (~5 minutes) and continue at "Submit to Play Store" below.

### Option B — Local build

```bash
cd apps/stopwatch
eas build --platform android --profile production --local --output stopwatch.aab
```

Requires JDK 17 and the Android SDK installed locally (see `docs/runbooks/mobile-development.md` for setup). This runs the Gradle build on your machine and produces `stopwatch.aab` directly — no queue wait.

### Option C — EAS cloud build

```bash
cd apps/stopwatch
eas build --platform android --profile production
```

- The `production` profile in `eas.json` should use `"credentialsSource": "remote"` so the signing keystore is fetched from EAS.
- Can queue for a long time on the free tier under load — prefer Option A or B if you need a build quickly.
- Build logs and the final `.aab` download link are available at [expo.dev](https://expo.dev) under the project's Builds tab.

All three options produce an equivalent signed `.aab` (Android App Bundle) — the format required by Play Store.

## Submit to Play Store

### Via EAS Submit (recommended)

```bash
eas submit --platform android --latest
```

This picks up the most recent successful build and submits it directly. EAS Submit needs a Google Play service-account JSON key configured in the project's EAS Submit settings (one-time setup in the Expo dashboard).

### Via manual upload

1. Get the `.aab` — from the GitHub Actions workflow run's Artifacts, your local build output, or expo.dev, depending on which build option you used above.
2. In Google Play Console → SplitSync Stopwatch → Release → select track → Create new release → Upload the `.aab`.

## Internal Testing → Production Promotion

1. Upload to the **Internal testing** track first.
2. Install from Play Store on a real Android device.
3. Verify:
   - App opens and shows the login / home screen.
   - Solo stopwatch works (no account needed).
   - Deep link `https://splitsync.org/stopwatch/s/XXXXXX` opens the Join screen correctly (requires App Links verification — see below).
   - Shared session: create a session (requires SplitSync account), share the link, join from a second device without an account.
4. Once verified, promote to **Production** via Play Console's "Promote release" button.

## App Links Verification (Deep Links)

For `https://splitsync.org/stopwatch/s/<code>` links to open the native app on Android (instead of the browser), the signing certificate SHA-256 must be listed in:

```
apps/web/public/.well-known/assetlinks.json
```

To get the SHA-256, **use the certificate Google Play actually signs the app with for end users, not the EAS upload keystore** — once Play App Signing is enabled (recommended, and accepted during this app's first release), Google re-signs every uploaded `.aab` with its own certificate before distributing it:

```
Play Console → SplitSync Stopwatch → Setup → App integrity → App signing key certificate → SHA-256 certificate fingerprint
```

`eas credentials → Android → production → View certificate fingerprint` shows the *upload key* fingerprint instead, which will not match what installed devices actually see and will silently fail App Links verification.

Add an entry to `assetlinks.json` in the format:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "org.splitsync.stopwatch",
      "sha256_cert_fingerprints": ["AA:BB:CC:..."]
    }
  }
]
```

Deploy the web app after updating this file so the change is live at `https://splitsync.org/.well-known/assetlinks.json` before testing App Links on device.
