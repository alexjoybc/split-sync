# SplitSync API Routes

These Next.js route handlers are deployed as Vercel Functions within the
existing `split-sync-web` project. Production endpoints are hosted at
`https://splitsync.org/api/...`; web clients use same-origin paths and mobile
clients call that production URL directly.

Authenticated routes require:

```text
Authorization: Bearer <Supabase access token>
```

`authenticateApiRequest()` verifies this token with Supabase and creates a
per-request Supabase client carrying the same bearer token. Database RLS stays
the authorization boundary: API routes must not use a `service_role` key or
duplicate event-role authorization checks.

## Health check

`GET /api/health` returns `200 { "status": "ok" }` without authentication.

## Environment

The API uses the Vercel project's existing variables:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

No secret Supabase key is needed.
