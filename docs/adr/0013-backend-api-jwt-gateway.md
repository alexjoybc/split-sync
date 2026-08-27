# ADR 0013: Same-Project Vercel API Routes With JWT-Forwarded RLS

## Status

Accepted.

## Decision

Introduce SplitSync's first backend HTTP surface as Next.js route handlers in
`apps/web/src/app/api`, deployed as Vercel Functions in the existing
`split-sync-web` Vercel project. The first unauthenticated route is
`GET /api/health`; future race-day endpoints use this same convention.

An authenticated route requires `Authorization: Bearer <Supabase access
token>`. The server verifies the token with Supabase's `auth.getUser(token)`.
For downstream database work it creates a per-request Supabase client with
that exact bearer token in the request headers. It does not use a
`service_role` key and does not independently reproduce event ownership or
volunteer-role checks. Supabase RLS remains SplitSync's only authorization
boundary.

Web clients call same-origin `/api/...`; mobile calls `https://splitsync.org/api/...`.
No CORS configuration is necessary for the web client because the API shares
its origin. API routes use the Vercel project's existing public Supabase URL
and publishable key only.

## Rationale

Manual finish-order entry needs a stable HTTP endpoint that both mobile and
web can use. Vercel supports Next route handlers as serverless functions, but
does not host a persistent Fastify process. Keeping this initial API in the
existing project avoids a second deployment, domain, CORS policy, and API-base
URL while still creating an explicit server boundary.

Validating then forwarding the caller's token preserves the security model
already enforced for direct browser/mobile Supabase access. A service-role
client would bypass RLS and create a second, easy-to-diverge authorization
implementation.

This is deliberately narrower than deferred issue #76: it supports the
existing organizer/scorer JWT identity only. A future timing connector may add
a distinct revocable connector-token authentication mode, but should submit
through the same crossing-ingestion contract rather than bypassing it.

## Consequences

- `apps/web` now contains browser-facing pages and server-only API helpers;
  server-only helpers live under `src/lib/server` and must not be imported by
  client components.
- `NEXT_PUBLIC_SUPABASE_*` variables remain required for all Vercel
  environments; no server secret is added for this API.
- Future API handlers must use the authenticated per-request client for data
  access and return clear HTTP errors instead of weakening RLS policies.
- Persistent vendor connector workers (file watchers, serial devices) still
  do not run on Vercel; they run on a timing laptop or separate persistent
  worker and call this HTTP API.
