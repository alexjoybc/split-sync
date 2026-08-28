-- 20260827000006_race_entry_statuses.sql replaced the "organizer manage
-- upcoming race entries" FOR ALL policy (which implicitly covered SELECT)
-- with separate insert/update/delete policies, without adding a
-- replacement SELECT policy for the event owner. The owner's identity
-- lives in events.owner_id and is never duplicated into event_members
-- (see 20260827000005_volunteer_roles.sql), so the owner had no way to
-- read entries rows for their own event unless it was published
-- (live/finished, covered by "public read published entries") or they
-- happened to also hold an event_members row (covered by
-- "member read entries").
--
-- This was invisible for plain insert/update/delete calls, which don't
-- ask PostgREST for a representation and so never trigger an RLS SELECT
-- check. It surfaced as a 403 ("new row violates row-level security
-- policy for table entries") once application code started using
-- upsert(), whose ON CONFLICT path always performs an internal
-- RETURNING regardless of the client's requested Prefer: return header,
-- and therefore always needs SELECT-policy visibility of the row (#141).

create policy "organizer read entries" on entries for select to authenticated
  using (exists (
    select 1 from races join events on events.id = races.event_id
    where races.id = entries.race_id and events.owner_id = auth.jwt()->>'sub'
  ));
