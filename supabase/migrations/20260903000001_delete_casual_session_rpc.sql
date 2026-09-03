-- Migration: delete_casual_session RPC
-- Allows the session owner to delete a casual session (and all its
-- participants and events via ON DELETE CASCADE).
--
-- Security model:
--   - SECURITY DEFINER so the function can bypass RLS and act as superuser
--     on the table, but it re-checks owner_id = auth.uid()::text explicitly.
--   - Raises an exception if the caller is not the owner or the session
--     does not exist, consistent with the pattern in
--     20260830000001_casual_stopwatch_sessions.sql.

create or replace function delete_casual_session(p_session_id uuid)
returns void language plpgsql security definer as $$
declare
  v_owner_id text := auth.uid()::text;
  v_session  casual_sessions;
begin
  if v_owner_id is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  select * into v_session from casual_sessions where id = p_session_id;

  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  if v_session.owner_id <> v_owner_id then
    raise exception 'UNAUTHORIZED';
  end if;

  -- Cascades to casual_session_participants and casual_session_events
  -- via ON DELETE CASCADE foreign keys defined in the base migration.
  delete from casual_sessions where id = p_session_id;
end;
$$;
