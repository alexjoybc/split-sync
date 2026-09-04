# ADR 0027: Shared Stopwatch Core Event Reducer

## Status

Decided.

## Context

The web stopwatch and native Expo stopwatch currently maintain independent
local-session persistence and timing representations. The redesigned shared
session model needs one event shape and deterministic state transition rules
on both clients, and later in the server snapshot writer.

## Decision

`packages/stopwatch-core` owns framework-neutral session JSON types, the
discriminated stopwatch/countdown timer state, wall-clock elapsed/remaining
helpers, and a pure `applyEvent` reducer. Event ids are retained in the
snapshot as deduplication keys, so retrying an event is a no-op. The package
has only a minimal async storage-adapter contract; web and native supply their
own `localStorage` and AsyncStorage adapters respectively.

Sessions and their event logs are stored separately. The local-session index
is capped at ten sessions, preserving the existing device-storage limit.

## Consequences

- Expo Metro and Next resolve the workspace package directly; no mirrored app
  copies are needed.
- Timer elapsed values are derived from wall-clock anchors rather than
  interval ticks, including after backgrounding.
- Follow-on UI and Supabase work must emit the documented event union and use
  the reducer for deterministic replay.
