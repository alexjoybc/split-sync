-- Fix two related casual-stopwatch RPC bugs (#413):
--
-- 1. get_session_state returned session/status/t0_server/name nested under a
--    `session` object, but every consumer (web SharedSessionView.refreshState,
--    the stored-participant verification effect, and native HomeScreen's
--    rejoin flow + rebuildFromServer in apps/stopwatch/App.tsx) reads them as
--    top-level fields — matching the flat shape already returned by
--    join_casual_session. Effect: every call to get_session_state (which
--    fires on mount of the shared session view, and on every reconnect/
--    rejoin) silently reset sessionName to null (heading fell back to
--    "Session <code>") and sessionStatus to undefined (breaking
--    Waiting/Running/Stopped rendering and any code branching on status).
--    Fix: return session_id/session_name/status/t0_server as top-level
--    fields, matching join_casual_session's existing flat convention.
--
-- 2. record_session_event's 'reset' branch updated casual_sessions and
--    deleted the event history, then returned null instead of the usual
--    event row. Both clients treat the RPC's return value as the event to
--    apply/broadcast:
--      - web: `const accepted = data as SessionEvent; applyEvent(accepted)`
--        runs unconditionally, so `applyEvent(null)` throws and the reset
--        surfaces as a generic "Action failed" error instead of returning
--        the session to "Waiting".
--      - native: `sendEvent` already guards with `if (data)`, so the reset
--        silently no-ops locally instead of crashing, but the owner's own
--        screen never updates until the next full state rebuild.
--    Fix: let 'reset' fall through to the same insert-and-return-event path
--    used by start/lap/stop (after the status update + history delete), so
--    the RPC always returns a normal event row. This also means a
--    reconnecting client can see a real "reset" event for lap-derivation
--    cutoff purposes, instead of only inferring the reset from
--    casual_sessions.status.
create or replace function get_session_state(p_session_id uuid, p_participant_id uuid)
returns json language plpgsql security definer as $$
declare
  v_participant casual_session_participants;
  v_session     casual_sessions;
begin
  select * into v_participant from casual_session_participants
    where id = p_participant_id and session_id = p_session_id;
  if not found then raise exception 'UNAUTHORIZED'; end if;

  select * into v_session from casual_sessions where id = p_session_id;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;

  return json_build_object(
    'session_id',   v_session.id,
    'session_name', v_session.name,
    'status',       v_session.status,
    't0_server',    v_session.t0_server,
    'participants', (select json_agg(p) from casual_session_participants p where p.session_id = p_session_id),
    'events',       (select json_agg(e order by e.sequence) from casual_session_events e where e.session_id = p_session_id)
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
    -- fall through to the shared insert/return below so callers get a real
    -- event row to apply/broadcast, instead of a bare null (#413).
  end if;
  -- upsert event (idempotent)
  insert into casual_session_events (id, session_id, actor_participant_id, event_type, client_recorded_at)
    values (p_client_event_id, p_session_id, p_participant_id, p_event_type, p_client_recorded_at)
    on conflict (id) do nothing;
  return row_to_json((select e from casual_session_events e where e.id = p_client_event_id));
end;
$$;
