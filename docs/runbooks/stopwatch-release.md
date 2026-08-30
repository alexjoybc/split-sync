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

Before building, bump the version in `apps/stopwatch/app.json`:

- `version` — human-readable string (e.g. `"1.1.0"`), shown in Play Store.
- `android.versionCode` — integer, **must increase monotonically** across every build submitted to Play Store. Never reuse a versionCode.

```json
{
  "expo": {
    "version": "1.1.0",
    "android": {
      "versionCode": 2
    }
  }
}
```

## Build

```bash
cd apps/stopwatch
eas build --platform android --profile production
```

- The `production` profile in `eas.json` should use `"credentialsSource": "remote"` so the signing keystore is fetched from EAS.
- The build artifact is an `.aab` (Android App Bundle) — the format required by Play Store.
- Build logs and the final `.aab` download link are available at [expo.dev](https://expo.dev) under the project's Builds tab.

## Submit to Play Store

### Via EAS Submit (recommended)

```bash
eas submit --platform android --latest
```

This picks up the most recent successful build and submits it directly. EAS Submit needs a Google Play service-account JSON key configured in the project's EAS Submit settings (one-time setup in the Expo dashboard).

### Via manual upload

1. Download the `.aab` from expo.dev.
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

To get the SHA-256:

```bash
eas credentials
# → Android → Production → View certificate fingerprint
```

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
