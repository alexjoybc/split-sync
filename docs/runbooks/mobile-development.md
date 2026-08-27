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
