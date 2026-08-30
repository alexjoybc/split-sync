# ADR 0017 — SplitSync Stopwatch as a Separate Expo App

## Status

Accepted

## Context

SplitSync targets consumer acquisition through a free-to-use stopwatch surface. A stopwatch must be:

- Installable by anyone searching the Play Store for a stopwatch (no sign-in barrier).
- Distinct from the organizer tracker (`apps/mobile`, `org.splitsync.tracker`) which requires auth.
- Visually part of the SplitSync suite (shared palette, typography, and product family feel).
- A future entry point into shared timing sessions (#184) via deep links.

Bundling the stopwatch inside the existing tracker app would:
- Force Play Store reviewers to see organizer-only content.
- Conflate two products with different audiences and permission models.
- Pollute the tracker's auth/session code paths with unauthenticated consumer flows.

## Decision

Scaffold `apps/stopwatch` as a fully separate Expo app ("SplitSync Stopwatch"):

| Property | Value |
|---|---|
| Expo SDK | Same minor series as `apps/mobile` (currently SDK 57) |
| Android package | `org.splitsync.stopwatch` |
| Deep-link scheme | `org.splitsync.stopwatch://` |
| Auth | None — the app has no sign-in |
| AsyncStorage | Not used in solo mode; no session tokens |
| Supabase | `EXPO_PUBLIC_*` publishable vars only, wired for #184 shared sessions |

The app lives in the pnpm workspace under `apps/*` (already matched by the root glob), is verified in CI with `pnpm --filter stopwatch exec tsc --noEmit`, and is built/installed via `pnpm --filter stopwatch exec expo run:android`.

## Consequences

- **Positive**: clean Play Store listing with zero auth friction; the stopwatch can be discovered independently and grow its own user base.
- **Positive**: tracker and stopwatch ship, update, and are reviewed independently.
- **Positive**: a "Time together" deep-link entry point (#184) is easy to add without touching the tracker.
- **Negative**: two Expo apps to maintain (two `android/` prebuild directories, two `app.json` files). Mitigated by sharing the pnpm workspace and keeping both apps on the same SDK version.
- **Neutral**: no iOS target yet; the `platforms` array in `app.json` is `["android"]` until an iOS build is formally scoped.
