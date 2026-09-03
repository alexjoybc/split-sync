-- Casual Stopwatch session lifecycle: owner-initiated close and delete (#345).
--
-- Previously a session could only become unjoinable passively, four hours
-- after creation (expires_at), and rows were never removed from the
-- database. This adds an explicit 'closed' terminal status the owner can
-- set at any time (ending a session early, blocking new joins/events while
-- keeping results readable), and a hard delete for removing a session and
-- all its participants/events entirely.

-- ---------------------------------------------------------------------------
-- Schema: allow 'closed' as a terminal status
-- ---------------------------------------------------------------------------

alter table casual_sessions drop constraint casual_sessions_status_check;
alter table casual_sessions add constraint casual_sessions_status_check
  check (status in ('waiting','running','stopped','closed'));

-- ---------------------------------------------------------------------------
-- Fix pre-existing bug: casual_sessions was never granted SELECT to
-- authenticated, so the web "My Sessions" list (apps/web/src/app/stopwatch,
-- a direct `.from("casual_sessions").select(...)`) has always failed with
-- "permission denied for table casual_sessions" in production. RLS ("owner
-- can manage own sessions") already scopes rows to the caller; this grant
-- just allows the query to run at all. Writes remain RPC-only.
-- ---------------------------------------------------------------------------

grant select on casual_sessions to authenticated;

-- ---------------------------------------------------------------------------
-- Fix pre-existing bug: generate_session_code()'s alphabet is 32 characters
-- (the comment claiming 34 is stale — it excludes O/I/0/1 from 36
-- alphanumerics, which is 32, not 34), but `(random()*33)::int + 1` produces
-- an index up to 34 — Postgres's `::int` cast on a float ROUNDS to the
-- nearest integer, it does not truncate, so `random()*33` in [0,33) rounds
-- to {0,...,33} (34 outcomes), +1 gives {1,...,34}, two past the end of the
-- alphabet. `substr` on an out-of-range position silently returns '', so a
-- meaningful fraction of characters per code are dropped, producing
-- 4/5-character codes instead of the 6 characters every caller (UI,
-- regexes, share links) assumes. Fixed with an explicit `floor()` for a
-- true truncation to a uniform 0..31 range.
-- ---------------------------------------------------------------------------

create or replace function generate_session_code() returns text language plpgsql as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- 32 chars, no O/I/0/1
  code text := '';
  i int;
begin
  for i in 1..6 loop
    code := code || substr(alphabet, floor(random()*32)::int + 1, 1);
  end loop;
  return code;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: close_casual_session — owner only. Ends a session early from any
-- non-terminal or already-stopped state. Closed sessions reject new joins
-- and new events, but remain readable (results, live view).
-- ---------------------------------------------------------------------------

create or replace function close_casual_session(p_session_id uuid)
returns json language plpgsql security definer as $$
declare
  v_session casual_sessions;
begin
  select * into v_session from casual_sessions where id = p_session_id;
  if not found or v_session.owner_id <> auth.uid()::text then
    raise exception 'UNAUTHORIZED';
  end if;
  if v_session.status = 'closed' then
    return row_to_json(v_session); -- idempotent no-op
  end if;
  update casual_sessions set status = 'closed' where id = p_session_id
    returning * into v_session;
  return row_to_json(v_session);
end;
$$;

revoke all on function close_casual_session(uuid) from public;
grant execute on function close_casual_session(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: delete_casual_session — owner only. Hard delete; cascades to
-- casual_session_participants and casual_session_events via existing FKs.
-- ---------------------------------------------------------------------------

create or replace function delete_casual_session(p_session_id uuid)
returns void language plpgsql security definer as $$
declare
  v_owner_id text;
begin
  select owner_id into v_owner_id from casual_sessions where id = p_session_id;
  if v_owner_id is null or v_owner_id <> auth.uid()::text then
    raise exception 'UNAUTHORIZED';
  end if;
  delete from casual_sessions where id = p_session_id;
end;
$$;

revoke all on function delete_casual_session(uuid) from public;
grant execute on function delete_casual_session(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Enforce 'closed' in the existing write paths
-- ---------------------------------------------------------------------------

create or replace function join_casual_session(p_code text, p_display_name text, p_client_id uuid)
returns json language plpgsql security definer as $$
declare
  v_session        casual_sessions;
  v_participant_id uuid;
begin
  select * into v_session from casual_sessions where code = p_code;
  if not found or v_session.expires_at < now()
     or v_session.status = 'stopped' or v_session.status = 'closed' then
    raise exception 'SESSION_NOT_JOINABLE';
  end if;
  if char_length(p_display_name) < 1 or char_length(p_display_name) > 30 then
    raise exception 'INVALID_DISPLAY_NAME';
  end if;
  -- idempotent re-join
  select id into v_participant_id from casual_session_participants
    where session_id = v_session.id and client_id = p_client_id;
  if found then
    return json_build_object(
      'session_id',     v_session.id,
      'participant_id', v_participant_id,
      'session_name',   v_session.name
    );
  end if;
  -- cap check
  if (select count(*) from casual_session_participants where session_id = v_session.id) >= v_session.participant_cap then
    raise exception 'SESSION_FULL';
  end if;
  insert into casual_session_participants (session_id, display_name, client_id)
    values (v_session.id, p_display_name, p_client_id)
    returning id into v_participant_id;
  return json_build_object(
    'session_id',     v_session.id,
    'participant_id', v_participant_id,
    'session_name',   v_session.name
  );
end;
$$;

create or replace function record_session_event(
  p_session_id         uuid,
  p_participant_id     uuid,
  p_event_type         text,
  p_client_recorded_at timestamptz,
  p_client_event_id    uuid
) returns json language plpgsql security definer as $$
declare
  v_session     casual_sessions;
  v_participant casual_session_participants;
begin
  -- verify participant belongs to session
  select * into v_participant from casual_session_participants
    where id = p_participant_id and session_id = p_session_id;
  if not found then raise exception 'UNAUTHORIZED'; end if;
  select * into v_session from casual_sessions where id = p_session_id;
  if v_session.status = 'closed' then
    raise exception 'SESSION_CLOSED';
  end if;
  -- concurrency rules
  if p_event_type = 'start' then
    if v_session.status = 'running' then raise exception 'SESSION_ALREADY_RUNNING'; end if;
    update casual_sessions set status = 'running', t0_server = coalesce(t0_server, now())
      where id = p_session_id;
  elsif p_event_type = 'lap' then
    if v_session.status != 'running' then raise exception 'SESSION_NOT_RUNNING'; end if;
  elsif p_event_type = 'stop' then
    if v_session.status != 'running' then return null; end if; -- no-op
    update casual_sessions set status = 'stopped' where id = p_session_id;
  elsif p_event_type = 'reset' then
    if not v_participant.is_owner then raise exception 'UNAUTHORIZED'; end if;
    if v_session.status != 'stopped' then raise exception 'SESSION_NOT_STOPPED'; end if;
    update casual_sessions set status = 'waiting', t0_server = null where id = p_session_id;
    delete from casual_session_events where session_id = p_session_id;
    return null;
  end if;
  -- upsert event (idempotent)
  insert into casual_session_events (id, session_id, actor_participant_id, event_type, client_recorded_at)
    values (p_client_event_id, p_session_id, p_participant_id, p_event_type, p_client_recorded_at)
    on conflict (id) do nothing;
  return row_to_json((select e from casual_session_events e where e.id = p_client_event_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Results/live-view: treat 'closed' as terminal alongside 'stopped'
-- ---------------------------------------------------------------------------

create or replace function get_casual_session_results(p_code text)
returns json language plpgsql security definer as $$
declare
  v_session casual_sessions;
begin
  select * into v_session from casual_sessions where code = upper(trim(p_code));
  -- Results exist only for terminal sessions: stopped, closed, or past the
  -- join expiry. Unknown codes and still-live sessions raise the same
  -- generic error so the code space cannot be probed for in-progress sessions.
  if not found
     or (v_session.status not in ('stopped', 'closed') and v_session.expires_at >= now()) then
    raise exception 'RESULTS_NOT_AVAILABLE';
  end if;
  return json_build_object(
    'session', json_build_object(
      'name',       v_session.name,
      'code',       v_session.code,
      'status',     v_session.status,
      'created_at', v_session.created_at,
      't0_server',  v_session.t0_server
    ),
    -- No participant ids: the participant_id UUID is the write bearer token
    -- (record_session_event). A public results read must never leak it, so
    -- actor names are resolved server-side onto each event instead.
    'participants', (
      select coalesce(
        json_agg(json_build_object(
          'display_name', p.display_name,
          'is_owner',     p.is_owner
        ) order by p.joined_at),
        '[]'::json
      )
      from casual_session_participants p
      where p.session_id = v_session.id
    ),
    'events', (
      select coalesce(
        json_agg(json_build_object(
          'event_type',         e.event_type,
          'client_recorded_at', e.client_recorded_at,
          'actor_name',         p.display_name,
          'sequence',           e.sequence
        ) order by e.sequence),
        '[]'::json
      )
      from casual_session_events e
      join casual_session_participants p on p.id = e.actor_participant_id
      where e.session_id = v_session.id
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Realtime: publish casual_sessions status changes (owner's session list
-- and any web live-viewer polling can react to a close without waiting on
-- expires_at). Participants inside an active shared-session screen learn of
-- a close via the SESSION_CLOSED error the next time they call
-- record_session_event, which already triggers a rebuild from server state.
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table casual_sessions;
