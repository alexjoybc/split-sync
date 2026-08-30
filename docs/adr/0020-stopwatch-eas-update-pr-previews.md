# ADR 0020 — EAS Update PR Previews for the Stopwatch App

## Status

Accepted

## Context

`apps/stopwatch` is a standalone Expo app (ADR 0017) distributed to end users through app stores, but during development it has no equivalent to `apps/web`'s Vercel preview deploys: reviewing a UI/behavior change requires either a native rebuild or running Metro locally and manually pointing a device at the developer's LAN IP. In practice this means:

- A PR author's Expo Go version can silently drift from the app's Expo SDK, breaking local previews with an opaque "incompatible" error.
- Reviewers without the branch checked out locally cannot preview a PR at all.
- There is no artifact tied to a PR that a non-technical reviewer (e.g. testing on a personal phone) can open with one tap.

EAS Update supports publishing an over-the-air JS bundle per branch and loading it directly in Expo Go (for Expo Go-compatible apps, which `apps/stopwatch` is — it uses only Expo-managed native modules). `expo-github-action`'s `preview` sub-action automates this: it publishes an update for a PR and comments on the PR with a QR code and link.

## Decision

- Link `apps/stopwatch` to an EAS project owned by the `split-sync` Expo account/org (not a personal account), matching how the Supabase project and domain are org-owned rather than personal.
- Add `apps/stopwatch/eas.json` with standard `development` / `preview` / `production` build profiles and update channels, and configure `app.json` with `runtimeVersion.policy: "sdkVersion"` and an `updates.url` pointing at the linked EAS project. `sdkVersion` (rather than `appVersion` or `fingerprint`) is required specifically because previews are opened in Expo Go: Expo Go can only load an update whose `runtimeVersion` matches its own Expo SDK version string (e.g. `57.0.0`), not an arbitrary app version.
- Add `.github/workflows/stopwatch-eas-preview.yml`, scoped with `paths: apps/stopwatch/**` so it only runs for PRs that touch the stopwatch app, using `expo-github-action/preview` to run `eas update --auto --branch <pr-head-ref>` and comment a QR code/link on the PR.
- Require an `EXPO_TOKEN` repository secret (a personal access token from the `split-sync` Expo account) for the workflow to authenticate; the workflow fails fast with an explanatory message if it's missing.
- Scope this ADR and workflow to `apps/stopwatch` only. `apps/mobile` (the organizer tracker, which requires auth and has a stricter release process) is an explicit non-goal here and would need its own ADR if adopted later.

## Consequences

- **Positive**: any reviewer with Expo Go installed can scan a QR code from the PR and load the exact change on a physical device, no local Metro server or LAN networking required.
- **Positive**: catches "PR breaks the JS bundle" issues in CI before merge, independent of the existing `tsc --noEmit` typecheck.
- **Negative**: adds an external dependency (Expo's EAS service and the `split-sync` Expo account) and a new secret (`EXPO_TOKEN`) that must be rotated/managed outside this repo.
- **Negative**: EAS Update previews only cover JS/asset changes. A PR that also changes native config (`app.json` plugins, native modules) still requires a real native build/install to verify fully.
- **Follow-up**: if `apps/mobile` adopts the same pattern, it will need its own EAS project (still under `split-sync`) and its own scoped workflow, since it has a different auth model and audience.
