-- ADR: docs/adr/0023-casual-session-live-view.md
--
-- Anonymous, read-only state for a live casual stopwatch session. The join
-- code permits viewing, but this function deliberately never exposes a
-- participant_id or other value that can be used to record an event.

create or replace function get_casual_session_live_view(p_code text)
returns json language plpgsql security definer as $$
declare
  v_session casual_sessions;
begin
  select * into v_session
    from casual_sessions
    where code = upper(trim(p_code));

  -- Use one error for absent and expired sessions to avoid code probing.
  -- A stopped (but not expired) session remains viewable so a mounted rider
  -- screen can show its final status until the results permalink takes over.
  if not found or v_session.expires_at < now() then
    raise exception 'LIVE_VIEW_NOT_AVAILABLE';
  end if;

  return json_build_object(
    'session', json_build_object(
      'name', v_session.name,
      'code', v_session.code,
      'status', v_session.status,
      't0_server', v_session.t0_server
    ),
    'participants', (
      select coalesce(json_agg(json_build_object(
        'display_name', p.display_name,
        'is_owner', p.is_owner
      ) order by p.joined_at), '[]'::json)
      from casual_session_participants p
      where p.session_id = v_session.id
    ),
    'events', (
      select coalesce(json_agg(json_build_object(
        'event_type', e.event_type,
        'client_recorded_at', e.client_recorded_at,
        'actor_name', p.display_name,
        'sequence', e.sequence
      ) order by e.sequence), '[]'::json)
      from casual_session_events e
      join casual_session_participants p on p.id = e.actor_participant_id
      where e.session_id = v_session.id
    )
  );
end;
$$;
