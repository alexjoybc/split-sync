# ADR 0016: Functional E2E Test Suite — Playwright + Local Supabase

## Status
Accepted

## Context
SplitSync's user flows (organizer event management, live scoring, public spectator boards) span multiple layers: the Next.js web app, Supabase RLS, and Supabase Realtime. Unit tests alone cannot catch cross-layer regressions. We needed functional E2E tests that exercise the full stack.

## Decision

### Test framework: Playwright
Playwright was chosen over Cypress, Selenium, and others for:
- First-class support for multiple browser contexts (needed for realtime scorer + spectator tests)
- Network interception and offline simulation
- Built-in `webServer` integration with Next.js
- Strong TypeScript support

### Local Supabase stack in CI
E2E tests run against a local Supabase instance (started with `supabase start`) rather than a hosted staging project because:
- **No external dependencies**: tests run entirely on the CI runner
- **Deterministic state**: `supabase db reset` applies migrations + seed on every run
- **No cost**: local Supabase uses Docker; no Supabase credits consumed
- **Isolation**: each PR has a fresh DB; no cross-PR contamination

### Email capture: Mailpit
Local Supabase includes Mailpit (port 54324) as an email sink. Auth emails (password reset, etc.) are captured via the Mailpit REST API rather than requiring a real SMTP server.

### Auth approach: programmatic session injection
For speed, most tests inject a Supabase session via localStorage rather than going through the login form. One spec (`auth.spec.ts`) exercises the actual login form UI. This gives good coverage without testing the login form on every spec.

### Seed strategy
A deterministic seed (`supabase/seed.sql`) provides stable UUIDs for stable assertions. Specs that need isolated state use programmatic `buildEvent` builders to avoid cross-spec contamination.

## Consequences
- E2E tests require Docker and Supabase CLI locally.
- CI jobs take ~3–5 minutes for the E2E job (Supabase startup + Playwright).
- All new user-facing web flows must include Playwright coverage (documented in AGENTS.md Working Rules).
