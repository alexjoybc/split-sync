# ADR 0023: Google OAuth for the Native Stopwatch App

## Status

Accepted.

## Context

ADR 0017 established that a casual stopwatch session creator "must sign in (Supabase auth, same project)", but the native stopwatch app (`apps/stopwatch`) shipped with only an email/password `LoginScreen`. The web stopwatch surface (`apps/web/src/app/stopwatch`) already gets Google sign-in for free because it redirects unauthenticated creators to the organizer `/login` page, which supports `supabase.auth.signInWithOAuth({ provider: "google" })`.

The native app cannot reuse a web page for this — it needs its own OAuth redirect handling. That redirect is a new cross-surface contract (a fourth `<scheme>://auth/callback` deep link, alongside the existing `org.splitsync.tracker://auth/callback` used by the mobile tracker per AGENTS.md), so per AGENTS.md this warrants an ADR even though it does not change the data model or RLS.

## Decision

Add a "Continue with Google" option to the stopwatch native `LoginScreen`, following the same pattern already proven in `apps/mobile/App.tsx`:

1. **Library**: `expo-web-browser` (`~15.0.11`, the SDK 54-compatible version installed via `npx expo install`), plus the existing `expo-linking` dependency. `WebBrowser.maybeCompleteAuthSession()` is called once at module load.
2. **Redirect URI**: `ExpoLinking.createURL("auth/callback")`, which resolves to `org.splitsync.stopwatch://auth/callback` — a new redirect URI that must be added to the Google provider's redirect allow-list in the hosted Supabase project (`bsihlrzncucrglqltjrc`). This is an operational (Supabase dashboard) change, not a code change.
3. **Flow**: `supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo, skipBrowserRedirect: true } })` opens the Google consent screen via `WebBrowser.openAuthSessionAsync`. On success, the returned callback URL is exchanged for a session with `supabase.auth.exchangeCodeForSession(code)` (PKCE), matching the `flowType: "pkce"` already configured in `apps/stopwatch/src/supabase.ts`.
4. **Deep-link safety net**: The app's existing `ExpoLinking.addEventListener("url", …)` / `getInitialURL()` handling (previously used only for `.../s/<code>` join links) now also recognizes `auth/callback` URLs and exchanges them the same way, in case Android redelivers the callback outside the `WebBrowser` promise.
5. **No signup**: Consistent with the existing "no signup, accounts via web" convention for this screen, Google sign-in only ever signs an existing or newly-Google-authenticated user in; there is no separate stopwatch-specific account creation flow.

No changes are made to `casual_sessions` or its RLS: `owner_id` is `auth.uid()::text`, which is already provider-agnostic (mirrors the `events.owner_id` pattern documented in AGENTS.md).

## Consequences

- `apps/stopwatch/package.json` gains a dependency on `expo-web-browser`; `apps/stopwatch/app.json` gains `"expo-web-browser"` in `plugins` (auto-added by `expo install`).
- The hosted Supabase project's Google OAuth provider configuration must include `org.splitsync.stopwatch://auth/callback` in its redirect allow-list before this ships to end users. This is tracked as an operational follow-up, not part of this repo.
- Joining a session remains fully anonymous; this change only affects the session-creator sign-in path.
- Future OAuth providers (if any) on this surface should reuse the same `consumeAuthCallbackUrl` helper in `apps/stopwatch/App.tsx` rather than introducing a parallel deep-link contract.
