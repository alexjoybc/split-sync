# ADR 0006: Event-Scoped Volunteer Roles Via Invite Links

## Status

Accepted. Supersedes the shared-PIN sketch in `events.scorer_pin` (issue #17) and the "Volunteer scorer access will be a scoped session/PIN model" line in ADR 0002.

## Decision

Introduce two tables, `event_members` and `event_invites`, to grant per-person, revocable, role-scoped access to a single event:

- `event_members(event_id, user_id, role, invited_by)` — an accepted grant. `user_id` is a JWT subject text value, following the same provider-neutral pattern as `events.owner_id` (ADR 0002), not a foreign key to `auth.users`.
- `event_invites(event_id, role, token, created_by, expires_at, used_at, used_by)` — a single-use, time-limited (14 day) link an organizer generates and shares out of band (text, email, printed sheet). There is no in-app email delivery.

Four roles exist, ordered by capability: `organizer` (co-owner: full roster/race/participant management and can invite/revoke others, but cannot delete the event or change `owner_id`), `scorer` (record/undo crossings, start/finish races), `checkin` (view the private roster before publish), `official` (read-only view of the whole event).

Accepting or previewing an invite goes through two `security definer` Postgres functions, `preview_event_invite(token)` and `accept_event_invite(token)`, rather than a direct-table RLS policy. This lets an unauthenticated visitor see what they're being invited to (event title, role) without a SELECT policy that would otherwise expose every invite token in the table to any authenticated user. Accepting requires sign-in (any Supabase-auth identity: Google or email/password, same as organizers) and is idempotent per `(event_id, user_id)`.

RLS policies on `events`, `races`, `entries`, `crossings`, and `participants` are extended (not replaced) with membership-aware read and write policies via two more `security definer` helpers, `is_event_owner(event_id)` and `has_event_role(event_id, roles[])`. These run with elevated privilege specifically so they can check `event_members` without the checking policy recursively re-invoking itself.

## Rationale

A single shared PIN (#17) has no per-person accountability and can't express "this person may score but not edit the roster." Zone4 and RACE RESULT both support scoped helper/staff access, which this issue's research cited as the bar to meet. Modeling roles as rows (not booleans on `events`) keeps the owner as the sole non-revocable identity while letting any number of volunteers be granted and revoked independently, mirroring how `docs/adr/0002` already treats `owner_id`.

Mobile (`apps/mobile`) intentionally does not consume this yet — per `AGENTS.md`'s surface table, the tracker is "event owner now, volunteers later." Only the web organizer surface (event setup + scorer pages) resolves `event_members` today.

## Consequences

- `events.scorer_pin` remains in the schema, still unused; a follow-up migration can drop it once nothing references it as a fallback.
- Revoking a member or invite takes effect immediately and at the RLS level — a volunteer's queued offline crossings will fail to insert once revoked, not just be hidden in the UI.
- Invite tokens are bearer secrets (like a magic link): whoever holds the URL can accept it once. Organizers should treat sharing a link like sharing a password and generate a fresh one per person.
- `organizer`-role members can invite and revoke other volunteers, including other `organizer`s. Only `owner_id` (the literal event owner) is exempt from being revoked, because it isn't stored as an `event_members` row.
- Adding a fifth role or per-race scoping (e.g., "scorer for Race B only") is additive: new enum value plus new policies, no schema migration of existing rows.
