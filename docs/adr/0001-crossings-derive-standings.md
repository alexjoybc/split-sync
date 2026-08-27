# ADR 0001: Derive Standings From Crossings

## Status

Accepted.

## Decision

Store individual line crossings as facts and derive position, lap count, gap, and last-lap time from them. Do not store a mutable standing or position column.

## Rationale

Grassroots timing needs easy correction. If a scorer accidentally records the wrong bib, a soft-deleted crossing immediately recalculates every affected position without a fragile manual recalculation flow. This also creates one normalized ingestion path for future hardware connectors.

## Consequences

- Reads recompute standings from race crossings.
- `client_id` makes queued mobile/web retries idempotent.
- `deleted_at` supports undo while retaining an audit trail.
- Scoring rules more complex than mass-start laps, such as points races, require a separate overlay rather than mutating base crossings.
