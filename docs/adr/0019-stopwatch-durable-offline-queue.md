# ADR 0019 — Stopwatch: Durable AsyncStorage Offline Event Queue

**Status:** Accepted  
**Date:** 2026-08-30  
**Issue:** #239

---

## Context

The stopwatch's shared-session pending queue was held entirely in memory. A failed RPC
triggered a server-state rebuild, but any events recorded while the device had no network
(airplane mode, tunnel, dead zone) or while the app was killed were permanently lost.

AGENTS.md invariant #6 states that `crossings.client_id` (and by analogy
`casual_session_events.id` / `client_event_id`) is a UUID idempotency key — **offline
queue retries must preserve it to avoid duplicates**. The tracker app (`apps/mobile`)
already enforces this pattern via `AsyncStorage` + `on conflict do nothing`. The stopwatch
surface had no equivalent durability guarantee.

---

## Decision

Persist every unacknowledged start/lap/stop/reset event to `AsyncStorage` under the key
`pending_events_<sessionCode>` **before** the RPC attempt. The entry schema:

```ts
interface DurableQueueEntry {
  client_event_id: string;      // UUID — idempotency key, must be preserved across retry
  event_type: SessionEventType; // start | lap | stop | reset
  client_recorded_at: string;   // original ISO timestamp (never regenerated)
  sequence: number;             // local monotonic counter for replay ordering
  sessionCode: string;
}
```

**Write path:** `addToDurableQueue` → RPC attempt → on success `removeFromDurableQueue`.
If the RPC fails (network or concurrency), the entry stays in storage.

**Flush path (`flushDurableQueue`):** Called on channel `SUBSCRIBED` (connect and
reconnect) and after `CHANNEL_ERROR`:

1. Load the durable queue from AsyncStorage.
2. Fetch current server state via `get_session_state` (existing RPC).
3. Drop entries whose `client_event_id` already appears in the server's event list
   (idempotency reconciliation — the `record_session_event` RPC already uses
   `ON CONFLICT (id) DO NOTHING`, so replaying is safe but we skip the round-trip
   if we can tell it succeeded).
4. Replay remaining entries in ascending `sequence` order, preserving the original
   `client_recorded_at`.
5. Each successful replay removes the entry from the durable queue.

**Pending indicator:** `Math.max(pendingQueue.length, durableQueueDepth)` — the spinner
reflects both inflight events and events queued for replay after reconnect.

---

## Database contract (unchanged)

`record_session_event` already performs:

```sql
insert into casual_session_events (id, …)
  values (p_client_event_id, …)
  on conflict (id) do nothing;
return row_to_json(…);  -- returns the row whether inserted or skipped
```

No migration is needed; the idempotency guarantee was already in place.

---

## Consequences

**Good:**
- Laps recorded in airplane mode survive app kill and appear exactly once in the session
  event log with their original `client_recorded_at`.
- The implementation matches the established pattern in `apps/mobile/src/crossingQueue.ts`.
- No schema changes; no new RPCs.

**Trade-offs:**
- Replay is sequential (one event at a time), which is safe for ordering but adds latency
  when flushing a large offline backlog. Acceptable given the infrequency of the scenario.
- `AsyncStorage` failures (disk full, permission error) are non-fatal — the existing
  in-memory path still works for the current run; the durable guarantee degrades silently.
  A console warning is emitted but no user-visible error is shown (consistent with how
  `crossingQueue.ts` handles this).
- A reset event followed by offline laps will be replayed as a reset (deleting all prior
  events server-side) then the laps — which is the correct order since sequence is
  preserved. However, if the session owner resets while a non-owner is offline, the
  non-owner's queued laps will fail replay (`SESSION_NOT_RUNNING`) and be dropped after
  `flushDurableQueue` encounters the first error and stops. This is acceptable: the reset
  is the authoritative action, and a full `rebuildFromServer()` follows.
