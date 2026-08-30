# Mobile Development

## Local Configuration

Create `apps/mobile/.env` from `.env.example`:

```text
EXPO_PUBLIC_SUPABASE_URL=https://bsihlrzncucrglqltjrc.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<Supabase publishable key>
```

These are public client values. Do not add a Supabase secret key.

## Android Direct Build

1. Enable Developer options and USB debugging on the Android device.
2. Connect USB and accept the computer's RSA debug prompt.
3. Install Android SDK Platform Tools and JDK 17.
4. Set shell environment:

```bash
export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
```

5. Confirm `adb devices` reports the device as `device`.
6. Build/install:

```bash
pnpm --filter mobile exec expo run:android
```

The generated `apps/mobile/android` and `apps/mobile/ios` directories are ignored. Regenerate them with `expo prebuild --clean` after adding a native module.

## Magic Links

Before mobile login works, Supabase Auth Redirect URLs must include:

```text
org.splitsync.tracker://**
```

The native app handles the returned access/refresh tokens and stores the authenticated session in AsyncStorage.

## iOS Later

The app is configured with bundle identifier `org.splitsync.tracker`. Install Xcode and use `pnpm --filter mobile exec expo run:ios --device` for connected-device testing. Apple signing/TestFlight is a later distribution concern.

---

## SplitSync Stopwatch (`apps/stopwatch`)

The stopwatch is a **separate standalone Expo app** (application id `org.splitsync.stopwatch`). Solo-stopwatch mode works without any environment variables. The **shared-session (Time Together)** feature connects to Supabase and requires credentials.

### Local configuration

Create `apps/stopwatch/.env`:

```text
EXPO_PUBLIC_SUPABASE_URL=https://bsihlrzncucrglqltjrc.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<Supabase publishable key>
```

These are the same public client values used by the web and mobile tracker. Do not add a Supabase service-role key.

### TypeScript check

```bash
pnpm --filter stopwatch exec tsc --noEmit
```

### Run on Android

Prerequisites are the same as for the tracker (ADB, JDK 17, `JAVA_HOME` / `ANDROID_HOME` set). The stopwatch and tracker can be installed side-by-side because they have different package IDs.

```bash
pnpm --filter stopwatch exec expo run:android
```

The generated `apps/stopwatch/android` directory is git-ignored. Regenerate it with `expo prebuild --clean` inside `apps/stopwatch` after adding a native module.

### Local native module: running-stopwatch notification

`apps/stopwatch/modules/stopwatch-notification` is a small local Expo module (Kotlin, Android-only, autolinked from the `modules/` directory) that posts the ongoing chronometer notification while a stopwatch is running (#231). Android renders the ticking elapsed time natively — there are no per-second JS wakeups. It requests `POST_NOTIFICATIONS` (Android 13+) at most once; if declined, the stopwatch works normally with no notification and no re-prompt.

Changing anything under `modules/stopwatch-notification` (or first pulling this module) **requires a native rebuild**: `expo prebuild --clean` then `pnpm --filter stopwatch exec expo run:android`. Until rebuilt, the JS side degrades to a no-op.

### Deep-link scheme

The stopwatch registers the scheme `org.splitsync.stopwatch://` and an Android App Links intent filter for `https://splitsync.org/stopwatch/s/`. Both open the Join screen. See `docs/runbooks/stopwatch-release.md` for how to configure `assetlinks.json` for verified App Links.

### Previewing a PR on your phone (EAS Update)

Every pull request that touches `apps/stopwatch/**` automatically publishes an EAS Update preview (see ADR 0018) and comments a QR code + link on the PR. This is the fastest way to check a change on a real device without running Metro locally:

1. Open the PR on GitHub and find the "EAS Update" bot comment.
2. Install **Expo Go** from the Play Store or App Store (make sure it's up to date — an outdated Expo Go is the most common cause of an "incompatible" error).
3. Scan the QR code from the comment, or open the link on the same device.

If you'd rather run it locally instead (e.g. no network access to expo.dev, or debugging Metro itself):

```bash
pnpm --filter stopwatch exec expo start
```

Then scan the terminal QR code with Expo Go, or open `exp://<your-machine-LAN-IP>:8081` manually. This requires your phone and computer to be on the same network, and still requires a matching Expo Go version for the app's Expo SDK.

To publish an update manually from your machine (e.g. to test the EAS Update pipeline itself, outside of a PR):

```bash
cd apps/stopwatch
eas update --branch <branch-name>
```

This requires being logged in to the `split-sync` Expo account (`eas login`).
