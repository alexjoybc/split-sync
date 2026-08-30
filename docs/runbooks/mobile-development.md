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

The stopwatch is a **separate standalone Expo app** (application id `org.splitsync.stopwatch`). It has no sign-in and requires no environment variables for its solo-stopwatch functionality.

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

### Deep-link scheme

The stopwatch registers the scheme `org.splitsync.stopwatch://`. Future shared-session flows (#184) will use this scheme for invite links.
