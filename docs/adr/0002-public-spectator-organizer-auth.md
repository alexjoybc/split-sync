# ADR 0002: Public Spectators, Authenticated Organizers

## Status

Accepted.

## Decision

Keep spectator results public and read-only. Authenticate organizers with Supabase magic links and authorize writes through row-level security keyed by an event owner subject.

## Rationale

A spectator should scan a QR code and see results without installing an app or creating an account. Race setup and scoring must be protected because a public publishable key is necessarily present in browser/mobile apps.

`events.owner_id` is stored as text from JWT `sub`, rather than foreign-keying `auth.users`. This keeps the model compatible with future Supabase OAuth providers and Auth0/OIDC-issued identities.

## Consequences

- Supabase URL/publishable keys may be public.
- Supabase secret/service-role keys must remain server-only and are not currently needed by app clients.
- Magic-link SMTP must be configured for real organizers.
- Volunteer scorer access will be a scoped session/PIN model, not anonymous write access.
