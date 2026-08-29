# ADR 0017: Casual Stopwatch — Shared Sessions, Anonymous Access, Realtime Contract, and Separate-App Architecture

## Status

Accepted.

## Context

SplitSync's three existing surfaces (Spectator, Organizer admin, Mobile tracker) all assume a structured event with a roster. A common grassroots timing scenario — two friends timing a hill-climb, a coach timing intervals with a remote assistant at the finish line — needs a shared stopwatch with no roster and no account. This is the casual stopwatch surface.

Every other issue in epic #186 implements what this document decides. The access model, event-log semantics, shared-control semantics, clock-sync strategy, realtime channel design, and app-suite integration are all cross-surface contracts. AGENTS.md requires an ADR before any implementation.

---

## Decisions

### 1. Data Model

Three tables support the casual stopwatch surface. All reside in the same hosted Supabase project (`bsihlrzncucrglqltjrc`) as the existing schema.

#### `casual_sessions`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PRIMARY KEY | Server-generated. |
| `code` | `text` UNIQUE NOT NULL | 6-character alphanumeric, uppercase, excluding visually ambiguous characters (0/O, 1/I). Entropy: 34^6 ≈ 1.6 billion combinations. |
| `status` | `text` NOT NULL | `'waiting' \| 'running' \| 'stopped'`. Transitions are append-only via events; this column is a denormalized cache updated by the `record_session_event` RPC only. |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | Server clock. |
| `expires_at` | `timestamptz` NOT NULL | Set to `created_at + interval '4 hours'` on creation. Extended by 30 minutes on each `lap` event (cap: original `expires_at + interval '12 hours'`). |
| `participant_cap` | `smallint` NOT NULL DEFAULT `10` | Hard maximum. `join_casual_session` rejects if at cap. |
| `t0_server` | `timestamptz` | NULL until first `start` event. Set by the server at the moment the `start` event is accepted. Immutable after set. The authoritative T0 for elapsed-time derivation. |

#### `casual_session_participants`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PRIMARY KEY | Server-generated. Returned to the client on join and stored locally (AsyncStorage / localStorage) as the participant's identity token. |
| `session_id` | `uuid` NOT NULL REFERENCES `casual_sessions(id)` | |
| `display_name` | `text` NOT NULL | 1–30 characters. Provided by the participant on join. |
| `joined_at` | `timestamptz` NOT NULL DEFAULT `now()` | |
| `is_owner` | `boolean` NOT NULL DEFAULT `false` | `true` only for the creator (the participant created by `create_casual_session`). Owner is the only one who can reset a stopped session. |

#### `casual_session_events`

The event log is the source of truth. Elapsed time and lap splits are **always derived** from this log — never persisted. This mirrors domain invariant #2 of the existing system.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PRIMARY KEY | Client-generated UUID (idempotency key, mirrors `crossings.client_id`). Duplicate submissions are silently ignored by the RPC (upsert on conflict). |
| `session_id` | `uuid` NOT NULL REFERENCES `casual_sessions(id)` | |
| `actor_participant_id` | `uuid` NOT NULL REFERENCES `casual_session_participants(id)` | Who triggered the event. |
| `event_type` | `text` NOT NULL | `'start' \| 'lap' \| 'stop' \| 'reset'`. |
| `client_recorded_at` | `timestamptz` NOT NULL | Client device timestamp at the moment of the tap. Used for lap-split derivation after T0 reconciliation (see §4). |
| `server_received_at` | `timestamptz` NOT NULL DEFAULT `now()` | Server clock at insertion time. Used to detect and compensate for clock skew. |
| `sequence` | `bigint` NOT NULL GENERATED ALWAYS AS IDENTITY | Monotone server-side ordering for replay and catch-up. |

Derived values (elapsed time, split durations) are computed from the event log on the client as:

```
elapsed_ms = (client_now - t0_server) + clock_offset_ms
split_ms   = client_recorded_at[lap_N] - client_recorded_at[lap_N-1]
             (adjusted by per-event skew, see §4)
```

No `standings`, `laps`, or `elapsed` column is ever persisted.

---

### 2. Anonymous Access Mechanism

**Decision: security-definer RPCs only. No direct anon table grants.**

Plain RLS cannot express "knows the code" without a lookup, and a lookup on `casual_sessions(code)` with anon select would allow enumeration of all sessions. The chosen model:

- RLS is **enabled** on all three tables as defense in depth. The anon role has **zero direct SELECT/INSERT/UPDATE grants** on any of the three tables.
- All access flows through three security-definer PostgreSQL functions (run as the `postgres` role, bypassing RLS):

| RPC | Description |
|---|---|
| `create_casual_session(display_name text)` | Creates session + owner participant. Returns `{ session_id, participant_id, code }`. Rate-limited to 10 calls per anon IP per 5 minutes via Supabase's built-in RLS rate-limit policy on the function. |
| `join_casual_session(code text, display_name text)` | Validates code, checks expiry, checks participant cap, creates participant row. Returns `{ session_id, participant_id }`. Fails with a generic error if code is unknown, expired, or stopped (no information leak). |
| `record_session_event(session_id uuid, participant_id uuid, event_type text, client_recorded_at timestamptz, client_id uuid)` | Validates participant membership, applies concurrency rules (§3), upserts the event (idempotent on `id`), updates `casual_sessions.status` and `t0_server` as needed. Returns the accepted event row. |

The `participant_id` returned by `create_casual_session` or `join_casual_session` is a UUID secret. It acts as a bearer token: any call to `record_session_event` without a valid `(session_id, participant_id)` pair is rejected. Clients persist `participant_id` in AsyncStorage (mobile) or `localStorage` (web) for the duration of the session. There is no auth.users row, no JWT, and no sign-in flow in this surface.

**Code entropy**: 6 characters from a 34-symbol alphabet (A-Z minus O and I, 2-9) gives 34^6 ≈ 1.6 billion combinations. At the rate limit of 10 join attempts per IP per 5 minutes, brute-force enumeration is not feasible. Codes are regenerated on session creation; there is no "vanity code" feature.

**Participant cap**: Default 10 per session. The `join_casual_session` RPC enforces this server-side. This limits abuse of a single session as a coordination channel.

---

### 3. Shared-Control Semantics

Any participant may call `record_session_event`. This is the whole point: a starter at the start line and a timer at the finish line can both operate the controls from their own devices. The following concurrency rules are enforced in `record_session_event`:

| Rule | Behavior |
|---|---|
| **First `start` wins** | If `casual_sessions.status` is already `'running'`, a subsequent `start` event is rejected with error code `SESSION_ALREADY_RUNNING`. The client that was "second" discards the attempt and syncs to the live state via the realtime channel. |
| **`lap` requires running** | A `lap` event is rejected if `status ≠ 'running'`. Error: `SESSION_NOT_RUNNING`. |
| **Duplicate events are idempotent** | The `id` (client UUID) is the idempotency key. A duplicate submission (same `id`) is silently accepted (upsert on conflict does nothing), and the original accepted row is returned. |
| **Late `stop`** | A `stop` event when `status = 'stopped'` is rejected with `SESSION_ALREADY_STOPPED`. The client syncs to the stopped state. |
| **A stopped session cannot be resumed** | There is no "resume" transition. A stopped session is terminal. Only a `reset` can restart the clock (see below). |
| **Reset** | Only the owner participant (`is_owner = true`) may submit a `reset` event. Reset transitions `status` to `'waiting'`, clears `t0_server`, and logically invalidates all prior events for elapsed-time purposes (the events remain in the log for audit). A reset creates a new logical "run" within the same session. |

---

### 4. Clock Sync — Server-Anchored T0

Device clocks can diverge significantly (up to tens of seconds on budget Android devices). The strategy:

1. **T0 is server-anchored.** When the first `start` event is accepted by `record_session_event`, the server sets `casual_sessions.t0_server = now()` atomically. This value is broadcast to all participants immediately via the realtime channel (see §5).

2. **Client clock offset estimation.** Each client estimates its offset from the server clock on connect using a simple NTP-style round-trip:
   ```
   offset_ms = (server_time - (t_send + rtt/2))
   ```
   where `server_time` is taken from the Supabase `X-Sb-Time` response header, `t_send` is the client timestamp before the HTTP call, and `rtt` is the full round-trip duration. This offset is stored in memory and applied to all `client_recorded_at` values the client submits.

3. **Elapsed time display.** All clients derive elapsed time as:
   ```
   elapsed_ms = (Date.now() + offset_ms) - t0_server.getTime()
   ```
   This ticks forward in real time on-device without a server round-trip. Because `t0_server` is fixed, all participants see the same elapsed time (within their individual `offset_ms` errors, typically < 200 ms after NTP correction).

4. **Lap-split derivation.** Lap splits are derived from consecutive `client_recorded_at` values from the event log, each adjusted by the offset that was active at submission time. The `server_received_at` column is stored but is used only for server-side audit, not for display time calculations.

5. **No persisted elapsed time.** The computed `elapsed_ms` is never written to the database. This mirrors domain invariant #2.

---

### 5. Realtime Contract

**Decision: Supabase Realtime Broadcast channel, keyed by session code.**

Postgres changes (`postgres_changes`) are not used for this surface because:
- The anon role has no table grants, so it cannot subscribe to row-level changes.
- Broadcast channels do not require table access and have lower latency for high-frequency events.

**Channel key**: `stopwatch:<code>` (e.g., `stopwatch:AB3K9X`). All participants in the same session join the same channel. The channel is created client-side; no server setup is required.

**Message shapes**:

All messages are JSON objects with a `type` discriminant.

| `type` | Sent by | Payload fields | When |
|---|---|---|---|
| `participant_joined` | Server (via RPC response trigger or client broadcast after RPC) | `participant_id`, `display_name`, `is_owner` | On successful `join_casual_session`. The joining client broadcasts this immediately after receiving the RPC response. |
| `participant_left` | Client (on `channel.unsubscribe()` / window close) | `participant_id` | Best-effort; not guaranteed on hard disconnect. |
| `session_event` | Client (after RPC confirms event) | `event_type`, `client_recorded_at`, `actor_participant_id`, `sequence`, `t0_server` (included only for `start` and `reset` events) | After `record_session_event` returns successfully. The broadcasting client uses the server's returned row (with `sequence` and `server_received_at`) to ensure all participants see consistent ordering. |
| `sync_request` | Client (on reconnect) | `last_sequence` | A reconnecting client broadcasts this to request a catch-up. |
| `sync_response` | Any connected peer | `events: [...]` | Any peer that holds a higher `sequence` responds with all events since `last_sequence`. If no peer responds within 2 seconds, the reconnecting client fetches from the event log via `record_session_event`-adjacent read RPC. |

**Reconnect and catch-up**: On reconnect, the client broadcasts a `sync_request` with its `last_sequence`. The first peer to respond sends a `sync_response` with the missing events. If no peer is available (all others disconnected), the client calls a `get_session_events(session_id, participant_id, since_sequence)` read-only security-definer RPC to replay from the database. This ensures correctness even in a single-participant scenario or after all peers disconnect.

**Presence**: Supabase Realtime Presence (built into the Broadcast channel) tracks who is currently connected. Clients use `channel.track({ participant_id, display_name })` on join. Presence state is displayed in the UI as a participant list. Presence does not require table access.

---

### 6. Lifecycle and Abuse Limits

**Session lifecycle states**:

```
waiting ──(start)──► running ──(stop)──► stopped
   ▲                                        │
   └──────────────────(reset)───────────────┘
                     (owner only)
```

**Expiry**:
- `expires_at` is set to `created_at + 4 hours` on creation.
- Each `lap` event extends `expires_at` by 30 minutes (capped at `created_at + 16 hours`).
- A nightly Postgres cron job (via `pg_cron`) soft-deletes sessions where `expires_at < now()` and `status ≠ 'stopped'` by setting `status = 'stopped'`. Stopped sessions are not deleted immediately; they are retained for 30 days for potential future export, then purged.
- The `join_casual_session` RPC rejects joins on expired sessions.

**Abuse limits** (enforced in the security-definer RPCs):
- `create_casual_session`: 10 per anon IP per 5 minutes (Supabase rate-limit policy).
- `join_casual_session`: 30 per anon IP per 5 minutes.
- `record_session_event`: 120 per `(session_id, participant_id)` per minute (prevents lap-spam).
- Participant cap: 10 per session (configurable per-session by the owner up to a hard maximum of 25, but default is 10).

**Abandoned session rules**: A session with `status = 'waiting'` that has had no event in 30 minutes is eligible for expiry. Sessions with `status = 'running'` are extended by lap events; a running session with no lap in 4 hours is stopped automatically by the cron job (as if a `stop` event had fired). This prevents indefinitely "running" orphaned sessions.

---

### 7. Separate-App Architecture — Fourth Surface

The casual stopwatch is a **fourth surface**, independent of the three existing surfaces.

| Surface | Location | Audience | Rules |
|---|---|---|---|
| Spectator | `apps/web/src/app/live`, `/results`, `/announce` | Public | No sign-in, read-only, mobile-first |
| Organizer admin | `apps/web/src/app` (`new`, `event`, `login`, `auth`) | Event owner | Authenticated writes, RLS-protected |
| Mobile tracker | `apps/mobile` | Event owner / volunteer | Authenticated, crossing-only input |
| **Casual stopwatch** | `apps/stopwatch` (native) + `apps/web/src/app/stopwatch` (web) | Public | **No sign-in, anonymous code-based sessions, event log is truth** |

**Native app** (`apps/stopwatch`):
- Framework: Expo SDK 57, React Native. Matches the tracker pattern (ADR 0003).
- Application ID: `org.splitsync.stopwatch`.
- Deep-link / universal link scheme: `https://splitsync.org/stopwatch/s/<code>` (App Links on Android, Universal Links on iOS). Custom-scheme fallback: `org.splitsync.stopwatch://s/<code>`.
- The app ships independently to the Google Play Store (tracked in #214). It is not part of the existing `apps/mobile` (tracker) release; it has its own EAS project slug and Play Store listing.
- Build and release tooling: **EAS Build** (`eas build --platform android`) for CI and release builds. Local `expo run:android` is used for development only. The EAS configuration (`eas.json`) lives at `apps/stopwatch/eas.json`. The specifics of Play Store submission are delegated to #214.

**Web app** (`apps/web/src/app/stopwatch`):
- A Next.js route group within the existing `apps/web` app. Served at `https://splitsync.org/stopwatch/`.
- The `/stopwatch/s/<code>` path is the universal join landing: it works in a browser without the native app installed (progressive entry point). If the native app is installed, the OS intercepts the URL and opens the native app.
- The web stopwatch is a self-contained single-page experience (no server components that require auth). It uses the same Supabase client and realtime channel as the native app.
- The web stopwatch route must not expose organizer controls or session-aware user data from the other three surfaces.

**Shared backend**: Both the native app and the web `/stopwatch` route use the same hosted Supabase project. Only `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY` (native) and `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (web) are used. No service-role key is ever used in client code.

**Relation to the other three surfaces**:
- **Branding**: Same visual language (race-paper palette, tokens from ADR 0015). The stopwatch app does not clone the organizer UI.
- **Backend**: Same Supabase project; no separate database or auth tenant.
- **Links**: The web `/stopwatch` entry point links to the main SplitSync site (`https://splitsync.org`) and vice versa. There is a "Create a full event" call-to-action from the stopwatch surface to the organizer flow, but it is informational only.
- **Auth**: There is **no sign-in** in the stopwatch app in this milestone. `casual_session_participants` are anonymous; they are not linked to `auth.users`. Suite integration is branding + backend + links, not shared auth.

---

### 8. Build and Release Tooling

The `apps/stopwatch` Expo project uses:
- **EAS Build** (`@expo/eas-cli`) for all CI and production builds.
- EAS project slug: `splitsync-stopwatch` (separate from `splitsync-tracker`).
- `eas.json` profiles: `development` (internal distribution), `preview` (APK for stakeholder testing), `production` (AAB for Play Store).
- The specifics of Play Store listing, signing keys, and TestFlight are delegated to #214.

Verification command for TypeScript (mirrors the mobile tracker convention):
```bash
pnpm --filter stopwatch exec tsc --noEmit
```

---

## Rationale

**Why security-definer RPCs instead of authenticated anon access?**
The defining feature of this surface is that there is no sign-in. Supabase's anon key combined with RLS policies can expose rows to any unauthenticated client — including the ability to enumerate session codes if a SELECT policy exists. Security-definer RPCs act as a narrow API surface: they enforce business rules (cap, expiry, concurrency) and return only what the caller is allowed to see, with no way to enumerate other sessions.

**Why Broadcast over postgres_changes?**
The anon role cannot subscribe to `postgres_changes` without table SELECT grants, which we explicitly disallow. Broadcast channels are the correct Supabase Realtime primitive for ephemeral, low-latency messaging between clients who share an out-of-band secret (the session code). Broadcast does not require database access.

**Why peer-to-peer catch-up with a fallback to RPC?**
Supabase Realtime channels have no built-in message history. Rather than persisting a dedicated "message replay" table, we exploit the fact that participants who stayed connected can relay events to a reconnecting peer. The fallback RPC (`get_session_events`) covers the single-participant or all-disconnected case without adding operational complexity.

**Why a separate app instead of adding stopwatch to `apps/mobile`?**
The tracker (`apps/mobile`) is an authenticated organizer tool. Mixing anonymous stopwatch sessions into it would blur the surfaces' permission models and release cadences. The Play Store listing for the tracker is organizer-targeted; the stopwatch targets a different (casual, public) audience. Separate apps also allow independent release cycles.

**Why a 6-character code?**
Six characters from a 34-symbol alphabet give ~1.6 billion combinations. At the enforced rate limit (30 join attempts per IP per 5 minutes), an attacker would need ~270 million 5-minute windows to enumerate half the space — effectively infeasible. Codes are shorter than a UUID, easy to read aloud, and do not need to be copied from a screen.

**Why is reset owner-only?**
Reset destroys the elapsed time of all participants for the current run. A non-owner participant resetting while others are timing would be disruptive. The owner is the one who created the session and bears responsibility for its lifecycle.

---

## Consequences

- Three new tables (`casual_sessions`, `casual_session_participants`, `casual_session_events`) are introduced in migration #180.
- Three security-definer RPCs (`create_casual_session`, `join_casual_session`, `record_session_event`) plus one read RPC (`get_session_events`) are introduced in migration #180.
- A `pg_cron` job for session expiry is added in migration #180.
- A fourth surface is added to the product. AGENTS.md surface table is updated in this PR.
- `apps/stopwatch` is a new Expo app in the monorepo. Implementing issues: #181 (web), #182 (native app), #183 (realtime), #184 (catch-up/sync).
- The web `/stopwatch` route is added to `apps/web` with no auth dependency.
- Elapsed time and lap splits are never persisted — derivation logic must live in every client implementation.
- Future consideration only: importing a casual session's events into a formal SplitSync `event` (roster-based). This is out of scope for this milestone.
