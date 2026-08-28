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

## POST /api/races/:raceId/crossings — Batch crossing ingestion

Ingests a manually-entered finish order for a race by writing an ordered set
of `crossings` rows with `source = 'manual'`. Intended for post-race manual
entry and connector integrations; produces the same standings output as
equivalent live-scorer taps.

### Authentication

`Authorization: Bearer <Supabase access token>` is required. The caller must
be the event owner or hold an `organizer` or `scorer` role in `event_members`
for the event that contains the race. These checks are enforced by RLS; no
separate role check is performed in the handler.

### Request

```http
POST /api/races/{raceId}/crossings
Content-Type: application/json
Authorization: Bearer <access_token>
```

```json
{
  "crossings": [
    {
      "bib": "42",
      "client_id": "550e8400-e29b-41d4-a716-446655440000",
      "client_recorded_at": "2026-08-27T22:10:03.000Z"
    },
    {
      "bib": "17",
      "client_id": "550e8400-e29b-41d4-a716-446655440001",
      "client_recorded_at": "2026-08-27T22:10:05.400Z"
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `crossings` | array | **Required.** Ordered array of crossings in finish order. Non-empty. |
| `crossings[i].bib` | string | **Required.** Rider bib number as recorded on the entry. |
| `crossings[i].client_id` | UUID | **Required.** Idempotency key. Re-submitting the same `client_id` is a no-op (not an error). Use a fresh UUID per crossing. |
| `crossings[i].client_recorded_at` | ISO 8601 | **Required.** Device clock timestamp at the moment of the crossing. Ordering is caller-supplied; the server does not reorder. |

### Response — 200 OK (partial success is normal)

```json
{
  "results": [
    { "client_id": "...", "bib": "42", "status": "inserted", "id": "<crossing uuid>" },
    { "client_id": "...", "bib": "17", "status": "already_applied" },
    { "client_id": "...", "bib": "99", "status": "rejected", "reason": "bib not found in race entries" }
  ]
}
```

| `status` | Meaning |
|---|---|
| `inserted` | Crossing created. `id` is the new `crossings.id`. |
| `already_applied` | `client_id` already exists — idempotent retry, treated as success. |
| `rejected` | Row was not inserted. `reason` explains why (e.g. unknown bib). |

### Error responses

| Status | Meaning |
|---|---|
| `400 Bad Request` | Malformed JSON, missing `crossings` array, empty array, or invalid field values (bib/client_id/timestamp). Response includes `details` array listing every field error. |
| `401 Unauthorized` | Missing or invalid `Authorization: Bearer` token. |
| `403 Forbidden` | Authenticated but caller does not have organizer/scorer access to this event. Response includes `results` for rows processed before the error was detected. |
| `404 Not Found` | `raceId` does not exist. |
| `422 Unprocessable Entity` | Race exists but is not `active`. Response includes the current status. |

### Idempotency

`client_id` is a globally-unique idempotency key (mirrors the offline-retry
contract used by the mobile tracker). Resubmitting an entire batch with the
same `client_id`s returns `already_applied` for every row and does not create
duplicates. Use a fresh UUID per crossing for distinct events.
