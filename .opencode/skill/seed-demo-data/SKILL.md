---
name: seed-demo-data
description: Populates a Supabase project (local or hosted) with realistic demo SplitSync events — bib-numbered riders, fake clubs, in-progress and finished races with lap-by-lap crossings, DNF/DSQ/penalty examples — all owned by a given organizer email. Use when the user asks to seed/populate demo data, generate demo events, or set up a demo/dry-run for SplitSync.
---

# Seed Demo Data

Creates 3 realistic demo events (one live, one finished, one draft) owned by
a real organizer, identified only by their **email address**. Nothing here
ever touches a `service_role` key, a DB password, or a persistent secret —
**this repo is public**, so treat every credential involved as something
that must never be echoed to a transcript, written into a repo file, or
committed, even temporarily.

## What gets created

Running this once creates, all owned by the resolved organizer:

1. **"SplitSync Demo: Friday Night Racing"** (velodrome, `status: live`)
   - an in-progress Scratch race (partial crossings, looks live right now)
   - a finished Points race (full lap-by-lap results)
   - an upcoming B race with a roster already assigned
2. **"SplitSync Demo: Fall Classic CX"** (cyclocross, `status: finished`)
   - three finished category races (Cat 1/2/3, Cat 4/5, Junior) with full
     results, a DNF, a DSQ + relegation penalty, and a time penalty
3. **"SplitSync Demo: Spring Time Trial Series"** (velodrome, `status: draft`)
   - two upcoming time-trial races with a roster, no crossings yet —
     exercises the organizer-only draft-event surface

This exercises all three product surfaces from `AGENTS.md`: spectator
(`live`/`finished` events), organizer admin (the `draft` event), and gives
realistic data for the mobile tracker to score against.

Re-running this skill for the same email is **idempotent**: any existing
`SplitSync Demo:%`-titled events owned by that user are deleted (which
cascades to their races/roster/entries/crossings/penalties) before being
recreated, so it never accumulates duplicate clutter.

## How it works

`generate-demo-sql.mjs` (in this skill's directory) is a dependency-free
Node script that prints one self-contained SQL script to stdout. It does
**not** connect to any database itself — it has no credentials at all. The
only input it needs is the organizer's email address, which it embeds in a
`select id from auth.users where email = ...` lookup *inside* the generated
SQL, wrapped in one atomic `do $$ ... $$` block. This means:

- No service-role key or admin API call is needed to resolve the email to a
  user id — plain SQL does it, inside the same transaction as the writes.
- The whole seed (delete-old + insert-new, across every table) is one
  transaction: it either fully applies or fully rolls back.
- The organizer must have already signed in to SplitSync at least once
  (magic link, Google, or email/password) — the script raises a clear
  Postgres exception naming the email if no matching `auth.users` row exists
  yet, instead of silently doing nothing.

## Running it

### Step 1 — ask the user what they're targeting

Ask (don't assume) whether this is for **local dev** or a **hosted**
Supabase project, and get the organizer's email address. Do not proceed
without an explicit email — never guess or reuse one from a previous run.

### Step 2 — generate the SQL to a scratch path outside the repo

Always write the generated SQL to the external scratch directory
(`/var/folders/.../T/opencode` or equivalent — never inside the repo working
tree, so it can never be accidentally `git add`ed):

```bash
node .opencode/skill/seed-demo-data/generate-demo-sql.mjs \
  --owner-email="<email>" > /tmp/opencode/seed-demo.sql
```

### Step 3a — local dev target

No credentials needed at all; the local stack's default Postgres role
already has full access:

```bash
supabase db query --local -f /tmp/opencode/seed-demo.sql
```

If the organizer doesn't have a local auth account yet, they can create one
by signing up at `http://localhost:3000/login` first, or, for a pure
scripted dry run, via the local GoTrue signup endpoint directly (local-only,
uses the well-known local demo anon key from `apps/web/.env.local`):

```bash
curl -s -X POST "http://127.0.0.1:54321/auth/v1/signup" \
  -H "apikey: $(grep NEXT_PUBLIC_SUPABASE_ANON_KEY apps/web/.env.local | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -d '{"email":"<email>","password":"<any password>"}'
```

### Step 3b — hosted target: ask for a short-lived access token

For the hosted project (`bsihlrzncucrglqltjrc`, see
`docs/runbooks/production-setup.md`), `supabase db query --project-ref` uses
the **Supabase Management API**, authenticated with a **personal access
token** — not a service_role key and not the DB password. Ask the user to:

1. Generate a token at https://supabase.com/dashboard/account/tokens,
   ideally one they'll revoke immediately after this run.
2. Provide it to you for this session only.

Then run, passing it only as an environment variable for that single
command — never write it to a file, never print it back, never let it land
in a commit or a script argument that could be logged in shell history
verbatim if avoidable:

```bash
SUPABASE_ACCESS_TOKEN="<token>" supabase db query \
  --project-ref bsihlrzncucrglqltjrc \
  -f /tmp/opencode/seed-demo.sql
```

After the run, remind the user to revoke the token from the dashboard if it
wasn't already short-lived/expiring.

### Step 4 — clean up and report

Delete the temp SQL file, then summarize what was created (event titles,
statuses, race counts) and, for the live/finished events, the spectator
URLs the user can open right away:

- `<site-url>/live/<event-id>`
- `<site-url>/results/<event-id>`
- `<site-url>/event/<event-id>` (organizer admin view, requires sign-in as
  the same owner)

Use `http://localhost:3000` for local, `https://splitsync.org` for hosted
(see `docs/runbooks/production-setup.md`), unless the user says otherwise.

## Safety rules (this repo is public)

- Never commit the generated SQL file, a token, a password, or a connection
  string anywhere in this repo, even in a throwaway branch or a script
  default value.
- Never hardcode a real hosted credential in `generate-demo-sql.mjs` or this
  skill file. The only thing the script's output ever contains besides SQL
  literals is the organizer's email address, which is not a secret.
- `generate-demo-sql.mjs` takes no database connection info at all by
  design — it can't leak what it never receives.
- If the user pastes a token or password directly into chat, do not echo it
  back in full in any tool call output or summary.
- Only ever scope deletes/inserts to `owner_id` resolved from the given
  email and to `title like 'SplitSync Demo:%'` — never touch other rows.
