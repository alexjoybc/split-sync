-- Fix (#431): 20260904000001 rewrote record_session_event from an older base
-- and accidentally dropped the ADR 0017 §6 lap-expiry-extension logic added
-- in 20260903000003 (each lap event should extend expires_at by 30 min,
-- capped at created_at + 12 hours, so an active session doesn't expire
-- mid-race). Restore it.
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
    -- ADR 0017 §6: extend expiry by 30 min on each lap, capped at 12 h from creation
    update casual_sessions
    set expires_at = least(
          greatest(expires_at, now() + interval '30 minutes'),
          created_at + interval '12 hours'
        )
    where id = p_session_id;
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
