---
name: deploy-local
description: Runs the latest main branch of SplitSync locally — installs deps, starts/resets local Supabase, and runs the web app and/or the stopwatch and mobile Expo apps on a connected device or simulator. Use when the user asks to "deploy locally", "run main locally", "spin up the app on my machine", or wants to test the stopwatch/mobile tracker against a device.
---

# Deploy Local

Brings up SplitSync locally from the current `main` (or the checked-out
branch) across whichever of the four surfaces the user needs: web,
stopwatch, and mobile. Nothing here touches the hosted Supabase project or
production credentials.

## The one gotcha this skill exists for: two env-var prefixes

SplitSync has **two unrelated env-var namespaces**, each read by a
different bundler, each with its own per-app `.env` file. Mixing them up is
the most common reason a local run silently fails to connect to Supabase.

| App | Prefix | File |
| --- | --- | --- |
| `apps/web` (Next.js) | `NEXT_PUBLIC_*` | `apps/web/.env.local` |
| `apps/mobile` (Expo) | `EXPO_PUBLIC_*` | `apps/mobile/.env` |
| `apps/stopwatch` (Expo) | `EXPO_PUBLIC_*` | `apps/stopwatch/.env` |

- Expo only inlines vars prefixed `EXPO_PUBLIC_`; a `NEXT_PUBLIC_` var (or
  vice versa) is silently ignored, not an error.
- Each Expo app has its **own** `.env` — copying `apps/mobile/.env` content
  into `apps/stopwatch/.env` (or skipping the second file entirely) is a
  common miss since they use the same two variable names.
- `apps/web/.env.local` points at the **local** Supabase instance
  (`http://127.0.0.1:54321` + the fixed local publishable key). `.env`
  files for `apps/mobile` and `apps/stopwatch` normally point at the
  **hosted** project (`https://bsihlrzncucrglqltjrc.supabase.co`) per
  `docs/runbooks/mobile-development.md` — a real device can't reach
  `127.0.0.1` on your laptop anyway. Don't "fix" mobile/stopwatch `.env` to
  point at localhost unless the user explicitly wants to test against local
  Supabase from a device on the same LAN (then use the laptop's LAN IP, not
  `127.0.0.1` or `localhost`).
- If a required var is missing, `apps/web/src/lib/supabase.ts` throws at
  module load with a message naming the exact vars it wants.

Before running anything, confirm the `.env`/`.env.local` files this task
needs actually exist (`.env.example` in each app directory is the
template); create them if missing and tell the user which values you used.

## Steps

### 1. Sync code

```bash
git status   # make sure there's nothing uncommitted in the way
git pull --ff-only origin main   # or the branch the user wants
pnpm install
```

### 2. Web app (`apps/web`)

```bash
supabase start
supabase db reset   # applies every migration in supabase/migrations + supabase/seed.sql
pnpm --filter web dev
```

- Web app: `http://localhost:3000`
- Supabase Studio: `http://127.0.0.1:54323`
- Sanity check: `curl http://localhost:3000/api/health` → `{"status":"ok"}`
- `supabase db reset` wipes local data and reseeds from `supabase/seed.sql`
  (a fake velodrome event) — skip it if the user has local data they want
  to keep, and just run `supabase start` instead.
- Never run `supabase/seed.sql` against anything but the local instance.

### 3. Stopwatch or mobile app, on a connected device

Confirm the per-app `.env` exists first (see table above).

```bash
export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
adb devices   # confirm exactly one device shows "device" (not "unauthorized")

pnpm --filter stopwatch exec tsc --noEmit   # or: pnpm --filter mobile exec tsc --noEmit
pnpm --filter stopwatch exec expo run:android   # or: pnpm --filter mobile exec expo run:android
```

- Run this as a background/long-lived command — it builds, installs the
  debug APK, launches the app, and then keeps Metro running in the
  foreground to serve JS. Don't wait for it to "finish"; watch the log for
  `Android Bundled ... index.ts` as the success signal, then check the
  focused window with `adb shell dumpsys window | grep mCurrentFocus`.
- If `expo run:android --device` is given a serial (e.g. from `adb
  devices`), it errors with "Could not find device with name" — that flag
  wants Android's marketing device name, not the ADB serial. With exactly
  one device attached, omit `--device`'s value (or the whole flag) and
  Expo auto-selects it.
- First run after a fresh clone or after adding a native module needs
  `expo prebuild --clean` inside the app directory before `expo run:android`
  (the generated `android/`/`ios/` dirs are git-ignored).
- iOS: `pnpm --filter mobile exec expo run:ios --device` (Xcode required).
  See `docs/runbooks/mobile-development.md` for the full prerequisites.

### 4. Report back

Tell the user which surfaces are now running, their URLs/device state, and
which `.env` files you created or already found in place — don't assume
they remember the `EXPO_PUBLIC_*` vs `NEXT_PUBLIC_*` split next time.

## References

- `README.md` — Local Development section
- `docs/runbooks/mobile-development.md` — mobile tracker + stopwatch setup,
  Android build prerequisites, EAS Update preview flow
- `docs/runbooks/production-setup.md` — what NOT to replicate locally
  (hosted Supabase secrets, Vercel env vars, Resend/DNS)
