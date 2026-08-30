-- ADR: docs/adr/0020-casual-session-results-permalink.md
--
-- Read-only results for finished casual stopwatch sessions (#226).
--
-- The share/join link dies once a session is stopped or expired
-- (join_casual_session rejects it), so there was no way to look at a
-- session's laps after the fact. This adds one anon-callable,
-- security-definer READ RPC keyed by the 6-char session code. It serves the
-- /stopwatch/s/<code>/results web page and deliberately ignores expires_at:
-- the event log is retained after the 4-hour join expiry, so results survive
-- it. No write path is added and the tables keep zero direct anon grants.

create or replace function get_casual_session_results(p_code text)
returns json language plpgsql security definer as $$
declare
  v_session casual_sessions;
begin
  select * into v_session from casual_sessions where code = upper(trim(p_code));
  -- Results exist only for terminal sessions: stopped, or past the join
  -- expiry. Unknown codes and still-live sessions raise the same generic
  -- error so the code space cannot be probed for in-progress sessions.
  if not found
     or (v_session.status <> 'stopped' and v_session.expires_at >= now()) then
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
